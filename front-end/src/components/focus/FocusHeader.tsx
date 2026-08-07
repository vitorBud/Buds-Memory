import { useEffect, useState } from 'react'

import { focusStyles } from '../../styles/focus'

export function FocusHeader() {
  const [greeting, setGreeting] = useState('')

  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 12) setGreeting('Bom dia')
    else if (hour < 18) setGreeting('Boa tarde')
    else setGreeting('Boa noite')
  }, [])

  return (
    <div className={focusStyles.header}>
      <h1 className={focusStyles.greeting}>
        {greeting}.
      </h1>
      <p className={focusStyles.subtitle}>
        O que vamos construir hoje?
      </p>
    </div>
  )
}
