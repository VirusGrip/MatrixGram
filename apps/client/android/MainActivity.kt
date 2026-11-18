package ru.madfrog.matrixgram

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Keep
class MainActivity : TauriActivity() {
  companion object {
    private val vaultLock = Any()
    private val createdDownloads = ConcurrentHashMap<String, Uri>()
    private val sharedInputs = ConcurrentHashMap<String, Uri>()
  }
  private val permissionLock = Any()
  private val fileDialogLock = Any()
  private var browser: WebView? = null
  private val main = Handler(Looper.getMainLooper())
  private external fun nativeVaultInit()
  private external fun nativeTlsInit(context: android.content.Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    nativeTlsInit(applicationContext)
    nativeVaultInit()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        browser?.evaluateJavascript("window.matrixgramBack ? window.matrixgramBack() : false") { result ->
          if (result != "true") moveTaskToBack(true)
        } ?: moveTaskToBack(true)
      }
    })
    if (savedInstanceState == null) receiveShare(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    browser = webView
    nativeTlsInit(applicationContext)
    nativeVaultInit()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    receiveShare(intent)
  }

  // Only native Rust calls these methods, after verifying the signed update package.
  fun getUpdatePath(): String {
    val directory = java.io.File(cacheDir, "updates").apply { mkdirs() }
    return java.io.File(directory, "matrixgram.apk").absolutePath
  }

  @Suppress("DEPRECATION")
  fun installUpdate(): String {
    val apk = java.io.File(getUpdatePath())
    require(apk.isFile) { "Update is missing" }
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val incoming = packageManager.getPackageArchiveInfo(apk.absolutePath, flags) ?: error("Invalid APK")
    val current = packageManager.getPackageInfo(packageName, flags)
    require(incoming.packageName == packageName) { "Wrong package" }
    val incomingVersion = if (Build.VERSION.SDK_INT >= 28) incoming.longVersionCode else incoming.versionCode.toLong()
    val currentVersion = if (Build.VERSION.SDK_INT >= 28) current.longVersionCode else current.versionCode.toLong()
    require(incomingVersion > currentVersion) { "Update must be newer" }
    fun certificates(info: android.content.pm.PackageInfo): Set<String> {
      val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
      return signatures.orEmpty().map { Base64.encodeToString(it.toByteArray(), Base64.NO_WRAP) }.toSet()
    }
    val installedCertificates = certificates(current)
    require(installedCertificates.isNotEmpty() && installedCertificates == certificates(incoming)) { "Signing key mismatch" }
    if (!packageManager.canRequestPackageInstalls()) {
      runOnUiThread { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
      return "permission"
    }
    val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.updates", apk)
    runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
    return "started"
  }

  // Invoked only through JNI from Rust. No JavascriptInterface exposes these methods.
  fun protectVault(bytes: ByteArray, encrypt: Boolean): ByteArray = synchronized(vaultLock) {
    val alias = "MatrixGram.session.v1"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!store.containsAlias(alias)) {
      if (!encrypt) throw IllegalStateException("Keystore key is missing")
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .setUserAuthenticationRequired(false)
          .build())
        generateKey()
      }
    }
    val key = store.getKey(alias, null) as SecretKey
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    if (encrypt) {
      cipher.init(Cipher.ENCRYPT_MODE, key)
      cipher.iv + cipher.doFinal(bytes)
    } else {
      require(bytes.size >= 28)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      cipher.doFinal(bytes.copyOfRange(12, bytes.size))
    }
  }

  fun requestMediaPermissions(video: Boolean): Boolean = synchronized(permissionLock) {
    val needed = if (video) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO)
    fun granted() = needed.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    if (granted()) return true
    val latch = CountDownLatch(1)
    runOnUiThread { requestPermissions(needed) { latch.countDown() } }
    latch.await(120, TimeUnit.SECONDS)
    granted()
  }

  fun requestNotifications(): Boolean = synchronized(permissionLock) {
    if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return true
    val latch = CountDownLatch(1)
    runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) { latch.countDown() } }
    latch.await(120, TimeUnit.SECONDS)
    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  }

  fun saveDownload(name: String, bytes: ByteArray): Boolean = synchronized(fileDialogLock) {
    val latch = CountDownLatch(1)
    var saved = false
    val safeName = name.replace('\\', '/').substringAfterLast('/').take(255)
    val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(safeName.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    runOnUiThread {
      val picker = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mime
        putExtra(Intent.EXTRA_TITLE, safeName)
      }
      launchActivityForResult(picker) { result ->
        val uri = result?.data?.data
        if (result?.resultCode != RESULT_OK || uri == null) { latch.countDown() }
        else Thread {
          try { contentResolver.openOutputStream(uri)?.use { it.write(bytes); saved = true } }
          catch (_: Exception) { saved = false }
          finally { latch.countDown() }
        }.start()
      }
    }
    latch.await(300, TimeUnit.SECONDS)
    saved
  }

  // Large files stay in Rust streams. Only an owned descriptor crosses JNI.
  fun createLargeDownload(name: String): String = synchronized(fileDialogLock) {
    val result = CompletableFuture<String>()
    val safeName = name.replace('\\', '/').substringAfterLast('/').take(255).ifBlank { "download.bin" }
    val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(safeName.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    runOnUiThread {
      launchActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE); type = mime; putExtra(Intent.EXTRA_TITLE, safeName)
      }) { selection ->
        val uri = selection?.data?.data
        if (selection?.resultCode != RESULT_OK || uri == null) result.complete("")
        else Thread {
          try {
            val descriptor = contentResolver.openFileDescriptor(uri, "w") ?: error("Output is unavailable")
            val id = java.util.UUID.randomUUID().toString()
            val fd = descriptor.detachFd(); descriptor.close()
            createdDownloads[id] = uri
            if (!result.complete(JSONObject().put("id", id).put("fd", fd).toString())) {
              ParcelFileDescriptor.adoptFd(fd).close(); finishLargeDownload(id, false)
            }
          } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(contentResolver, uri) }
            result.completeExceptionally(error)
          }
        }.start()
      }
    }
    try { result.get(120, TimeUnit.SECONDS) }
    catch (error: Exception) { result.cancel(true); throw error }
  }

  fun finishLargeDownload(id: String, success: Boolean) {
    val uri = createdDownloads.remove(id) ?: return
    if (!success) runCatching { DocumentsContract.deleteDocument(contentResolver, uri) }
  }

  fun openSharedFile(handle: String): Int {
    val uri = sharedInputs[handle] ?: error("Shared file is unavailable")
    require(uri.scheme == "content")
    val descriptor = contentResolver.openFileDescriptor(uri, "r") ?: error("Shared file cannot be opened")
    return descriptor.detachFd().also { descriptor.close() }
  }
  fun releaseSharedFile(handle: String) { sharedInputs.remove(handle) }
  @Suppress("DEPRECATION")
  private fun receiveShare(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND && intent?.action != Intent.ACTION_SEND_MULTIPLE) return
    val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(16000)
    val uris: List<Uri> = if (intent?.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
      else listOfNotNull(intent?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
    Thread {
      try {
        val files = JSONArray()
        val registered = mutableListOf<String>()
        try {
          for (uri in uris.take(10)) {
            require(uri.scheme == "content")
            require(sharedInputs.size < 100) { "Too many shared files" }
            var name = "shared-file"
            var size: Long? = null
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
              if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex).takeIf { it >= 0 }
              }
            }
            require(size == null || size!! <= 524288000L) { "File exceeds 500 MiB" }
            val handle = java.util.UUID.randomUUID().toString()
            sharedInputs[handle] = uri; registered.add(handle)
            files.put(JSONObject().put("nativeHandle", handle).put("name", name.take(255)).put("mime", contentResolver.getType(uri) ?: "application/octet-stream").put("size", size ?: JSONObject.NULL))
          }
        } catch (error: Exception) { registered.forEach { sharedInputs.remove(it) }; throw error }
        val payload = JSONObject().put("files", files).put("text", text ?: "")
        deliverShare(payload, 0)
      } catch (_: Exception) {
        main.post { Toast.makeText(this, "Не удалось получить файл. Размер каждого файла — до 500 МБ.", Toast.LENGTH_LONG).show() }
      }
    }.start()
  }

  private fun deliverShare(payload: JSONObject, attempt: Int) {
    fun retryOrRelease() {
      if (attempt < 60) main.postDelayed({ deliverShare(payload, attempt + 1) }, 500)
      else payload.optJSONArray("files")?.let { files ->
        for (index in 0 until files.length()) releaseSharedFile(files.optJSONObject(index)?.optString("nativeHandle") ?: "")
      }
    }
    main.post {
      browser?.evaluateJavascript("Boolean(window.matrixgramShareReady)") { ready ->
        if (ready == "true") browser?.evaluateJavascript("window.dispatchEvent(new CustomEvent('matrixgram-share', {detail: $payload}))", null)
        else retryOrRelease()
      } ?: retryOrRelease()
    }
  }
}

class MatrixGramUpdateProvider : androidx.core.content.FileProvider()
