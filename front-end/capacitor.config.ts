import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Mantido para atualizar o app instalado e conservar o container local do iOS.
  appId: 'com.vitor.aethermemory',
  appName: 'Buds Memory',
  webDir: 'dist',
  backgroundColor: '#090a0d',
  loggingBehavior: 'debug',
  ios: {
    backgroundColor: '#090a0d',
    contentInset: 'never',
    scrollEnabled: true,
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
  },
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
}

export default config
