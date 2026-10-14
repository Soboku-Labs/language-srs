plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
}

group = "com.languagesrs"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    // OkHttp rather than Ktor: this library is destined for an Android app, where
    // OkHttp is already present under Retrofit and most other things, so taking
    // it costs nothing on the platform that matters.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation(kotlin("test"))
}

kotlin { jvmToolchain(21) }

tasks.test {
    useJUnitPlatform()
    // The integration tests need a server; they skip themselves without one.
    environment("LANGUAGESRS_API", System.getenv("LANGUAGESRS_API") ?: "")
    testLogging { events("passed", "skipped", "failed") }
}
