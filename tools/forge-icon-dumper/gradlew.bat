@echo off
REM Standard Gradle wrapper batch script for Windows.
REM The wrapper JAR (gradle/wrapper/gradle-wrapper.jar) must exist.
REM Generate it once with: gradle wrapper --gradle-version=2.14.1

java %JAVA_OPTS% -jar "%~dp0gradle\wrapper\gradle-wrapper.jar" -p "%~dp0" %*
