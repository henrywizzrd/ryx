Pod::Spec.new do |s|
  s.name           = 'RyxNet'
  s.version        = '1.0.0'
  s.summary        = 'Local DNS-over-HTTPS proxy for Ryx web views'
  s.description    = 'Runs an HTTP CONNECT proxy on 127.0.0.1 that resolves host names over DNS-over-HTTPS and points WKWebsiteDataStore.default() at it (iOS 17+).'
  s.license        = 'MIT'
  s.author         = 'henrywizzrd'
  s.homepage       = 'https://github.com/henrywizzrd/ryx'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/henrywizzrd/ryx.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
