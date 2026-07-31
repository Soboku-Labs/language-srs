require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = package['version']
  s.summary        = 'Shares the language-srs widget payload between the app and its WidgetKit extension.'
  s.description    = 'Reads and writes the widget snapshot in the App Group container, and reloads WidgetKit timelines.'
  s.author         = 'language-srs'
  s.homepage       = 'https://github.com/Vishesh-Gupta/language-srs'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: 'https://github.com/Vishesh-Gupta/language-srs' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
