plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "hu.jegyterminal.launcher"
    compileSdk = 34
    defaultConfig {
        applicationId = "hu.jegyterminal.launcher"
        minSdk = 21
        targetSdk = 34
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
        versionCode = 4
        versionName = "2.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].java.srcDirs("src/main/kotlin")
}
dependencies { implementation("org.mozilla.geckoview:geckoview:144.0.20251027123126") }
