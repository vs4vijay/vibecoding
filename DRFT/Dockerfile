# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS toolchain
ARG JDK_VERSION ANDROID_CMDLINE_TOOLS_VERSION ANDROID_COMPILE_SDK ANDROID_COMPILE_SDK_EXTENSION ANDROID_BUILD_TOOLS ANDROID_NDK_VERSION
ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-${JDK_VERSION}-openjdk-amd64 \
    GRADLE_USER_HOME=/home/builder/.gradle \
    PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:${PATH}
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git openjdk-${JDK_VERSION}-jdk-headless patch python3 shellcheck tar unzip zip \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/android-sdk/cmdline-tools /root/.android \
    && touch /root/.android/repositories.cfg \
    && curl --fail --location --retry 3 \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip" -o /tmp/tools.zip \
    && unzip -q /tmp/tools.zip -d /opt/android-sdk/cmdline-tools \
    && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm /tmp/tools.zip \
    && yes | sdkmanager --licenses >/dev/null \
    && sdkmanager "emulator" "platform-tools" "platforms;android-${ANDROID_COMPILE_SDK}" "platforms;android-${ANDROID_COMPILE_SDK_EXTENSION}" "build-tools;${ANDROID_BUILD_TOOLS}" "ndk;${ANDROID_NDK_VERSION}" \
    && chmod -R a+rX /opt/android-sdk

FROM toolchain AS runtime
ARG JDK_VERSION ANDROID_COMPILE_SDK ANDROID_COMPILE_SDK_EXTENSION ANDROID_BUILD_TOOLS ANDROID_NDK_VERSION BUNDLETOOL_VERSION
ENV DRFT_IMAGE_JDK_VERSION=${JDK_VERSION} \
    DRFT_IMAGE_COMPILE_SDK=${ANDROID_COMPILE_SDK} \
    DRFT_IMAGE_COMPILE_SDK_EXTENSION=${ANDROID_COMPILE_SDK_EXTENSION} \
    DRFT_IMAGE_BUILD_TOOLS=${ANDROID_BUILD_TOOLS} \
    DRFT_IMAGE_NDK_VERSION=${ANDROID_NDK_VERSION} \
    ANDROID_BUNDLETOOL_PATH=/opt/bundletool.jar
USER root
RUN apt-get update && apt-get install -y --no-install-recommends findutils gzip make nodejs perl ruby \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --retry 3 \
      "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar" \
      -o /opt/bundletool.jar \
    && chmod a+r /opt/bundletool.jar
RUN mkdir -p /workspace /home/builder/.gradle \
    && chown -R 1000:1000 /workspace /home/builder
USER 1000:1000
WORKDIR /workspace
CMD ["bash"]
