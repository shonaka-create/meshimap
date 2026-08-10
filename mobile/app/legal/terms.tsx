import { LegalDoc } from '../../src/components/LegalDoc'
import { LEGAL_UPDATED, TERMS } from '../../src/legal/content'

/**
 * 利用規約（EULA）。
 * 本文は src/legal/content.ts にあり、Web（app/legal/terms）と共有している。
 */
export default function Terms() {
  return (
    <LegalDoc
      updated={LEGAL_UPDATED}
      intro={TERMS.intro}
      clauses={TERMS.clauses}
    />
  )
}
