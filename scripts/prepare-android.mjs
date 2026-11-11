import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'apps/client/src-tauri/gen/android/app');
if(!existsSync(app))throw new Error('Run tauri android init first');
copyFileSync(path.join(root,'apps/client/android/MainActivity.kt'),path.join(app,'src/main/java/ru/madfrog/matrixgram/MainActivity.kt'));
const manifestPath=path.join(app,'src/main/AndroidManifest.xml');
let manifest=readFileSync(manifestPath,'utf8');
for(const permission of ['RECORD_AUDIO','CAMERA','POST_NOTIFICATIONS','REQUEST_INSTALL_PACKAGES'])if(!manifest.includes(`android.permission.${permission}`))manifest=manifest.replace('<application',`<uses-permission android:name="android.permission.${permission}"/>\n    <application`);
if(!manifest.includes('android:allowBackup'))manifest=manifest.replace('<application','<application android:allowBackup="false"');
if(!manifest.includes('android.intent.action.SEND'))manifest=manifest.replace('</activity>',`<intent-filter><action android:name="android.intent.action.SEND"/><category android:name="android.intent.category.DEFAULT"/><data android:mimeType="*/*"/></intent-filter><intent-filter><action android:name="android.intent.action.SEND_MULTIPLE"/><category android:name="android.intent.category.DEFAULT"/><data android:mimeType="*/*"/></intent-filter></activity>`);
if(!manifest.includes('matrixgram_update_paths'))manifest=manifest.replace('</application>', '<provider android:name=".MatrixGramUpdateProvider" android:authorities="${applicationId}.updates" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/matrixgram_update_paths"/></provider></application>');
mkdirSync(path.join(app,'src/main/res/xml'),{recursive:true});
writeFileSync(path.join(app,'src/main/res/xml/matrixgram_update_paths.xml'),'<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="updates" path="updates/"/></paths>');
writeFileSync(manifestPath,manifest);
const gradlePath=path.join(app,'build.gradle.kts');
let gradle=readFileSync(gradlePath,'utf8').replace(/compileSdk = \d+/,'compileSdk = 36').replace(/targetSdk = \d+/,'targetSdk = 36').replace(/minSdk = \d+/,'minSdk = 26');
if(!gradle.includes('// MatrixGram persistent release signing')) {
  gradle=gradle.replace('    buildTypes {', `    // MatrixGram persistent release signing
    signingConfigs {
      create("matrixgramRelease") {
        val keyPath = System.getenv("MATRIXGRAM_ANDROID_KEYSTORE_PATH")
        if (!keyPath.isNullOrBlank()) {
          storeFile = file(keyPath)
          storePassword = System.getenv("MATRIXGRAM_ANDROID_STORE_PASSWORD")
          keyAlias = System.getenv("MATRIXGRAM_ANDROID_KEY_ALIAS")
          keyPassword = System.getenv("MATRIXGRAM_ANDROID_KEY_PASSWORD")
        }
      }
    }
    buildTypes {`);
  gradle=gradle.replace('getByName("release") {',`getByName("release") {
            if (!System.getenv("MATRIXGRAM_ANDROID_KEYSTORE_PATH").isNullOrBlank()) signingConfig = signingConfigs.getByName("matrixgramRelease")`);
}
// Match the JVM component to the locked Rust dependency, including on clean builds.
const verifierVersion=readFileSync(path.join(root,'Cargo.lock'),'utf8').match(/name = "rustls-platform-verifier-android"\r?\nversion = "([^"]+)"/)?.[1];
if(!verifierVersion)throw new Error('Missing locked Android TLS verifier');
gradle=gradle.replace(/^.*implementation\("org\.rustls:rustls-platform-verifier:.*\r?\n/gm,'');
gradle=gradle.replace('dependencies {',`dependencies {\n    implementation("org.rustls:rustls-platform-verifier:${verifierVersion}")`);
if(!gradle.includes('maven-archive/android-release-support'))gradle+='\nrepositories { maven { url = uri("https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/") } }\n';
writeFileSync(gradlePath,gradle);
writeFileSync(path.join(app,'matrixgram.pro'),'-keep class ru.madfrog.matrixgram.MainActivity { *; }\n-keep,includedescriptorclasses class org.rustls.platformverifier.** { *; }\n');
const properties=path.join(app,'../gradle.properties');
let settings=readFileSync(properties,'utf8');
if(!settings.includes('android.overridePathCheck'))settings+='\nandroid.overridePathCheck=true\n';
if(!settings.includes('org.gradle.workers.max'))settings+='org.gradle.workers.max=2\n';
writeFileSync(properties,settings);
console.log('Android: Keystore, Back, media permissions and share target configured (API 26–36).');
