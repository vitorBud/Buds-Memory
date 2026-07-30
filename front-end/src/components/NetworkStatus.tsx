import { useEffect, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toastStyles } from '../styles/notificacoes'

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showOnlineToast, setShowOnlineToast] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setShowOnlineToast(true)
      setTimeout(() => setShowOnlineToast(false), 3500)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowOnlineToast(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className={`network-status-container ${toastStyles.container}`}>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            key="offline"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={`network-status-toast offline ${toastStyles.base} ${toastStyles.offline}`}
          >
            <div className={`network-status-icon ${toastStyles.icon} ${toastStyles.offlineIcon}`}>
              <WifiOff size={18} />
            </div>
            <div className={`network-status-text ${toastStyles.text}`}>
              <strong>Modo Offline</strong>
              <span>Verifique sua conexão. Funcionalidades de pesquisa web e nuvem suspensas.</span>
            </div>
          </motion.div>
        )}

        {isOnline && showOnlineToast && (
          <motion.div
            key="online"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={`network-status-toast online ${toastStyles.base} ${toastStyles.online}`}
          >
            <div className={`network-status-icon ${toastStyles.icon} ${toastStyles.onlineIcon}`}>
              <Wifi size={18} />
            </div>
            <div className={`network-status-text ${toastStyles.text}`}>
              <strong>Online Novamente</strong>
              <span>Conexão restabelecida. Todos os serviços operantes.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
