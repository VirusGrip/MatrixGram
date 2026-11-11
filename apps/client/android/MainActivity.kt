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
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Keep
class MainActivity : TauriActivity() {
  companion object { private val vaultLock = Any() }
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

  @Suppress("DEPRECATION")
  private fun receiveShare(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND && intent?.action != Intent.ACTION_SEND_MULTIPLE) return
    val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(16000)
    val uris: List<Uri> = if (intent?.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
      else listOfNotNull(intent?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
    Thread {
      try {
        val files = JSONArray()
        var total = 0
        for (uri in uris.take(10)) {
          require(uri.scheme == "content")
          var name = "shared-file"
          contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) name = cursor.getString(0) ?: name }
          val bytes = ByteArrayOutputStream()
          contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              total += count
              require(total <= 25 * 1024 * 1024)
              bytes.write(buffer, 0, count)
            }
          } ?: throw IllegalStateException("File is unavailable")
          files.put(JSONObject().put("name", name.take(255)).put("mime", contentResolver.getType(uri) ?: "application/octet-stream").put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)))
        }
        val payload = JSONObject().put("files", files).put("text", text ?: "")
        deliverShare(payload, 0)
      } catch (_: Exception) {
        main.post { Toast.makeText(this, "Не удалось получить файл. Общий размер — до 25 МБ.", Toast.LENGTH_LONG).show() }
      }
    }.start()
  }

  private fun deliverShare(payload: JSONObject, attempt: Int) {
    main.post {
      browser?.evaluateJavascript("Boolean(window.matrixgramShareReady)") { ready ->
        if (ready == "true") browser?.evaluateJavascript("window.dispatchEvent(new CustomEvent('matrixgram-share', {detail: $payload}))", null)
        else if (attempt < 60) main.postDelayed({ deliverShare(payload, attempt + 1) }, 500)
      } ?: if (attempt < 60) main.postDelayed({ deliverShare(payload, attempt + 1) }, 500) else Unit
    }
  }
}

class MatrixGramUpdateProvider : androidx.core.content.FileProvider()
