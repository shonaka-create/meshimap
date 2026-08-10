import { LegalDoc } from '../../src/components/LegalDoc'
import { LEGAL_UPDATED, PRIVACY } from '../../src/legal/content'

/**
 * プライバシーポリシー。
 * 本文は src/legal/content.ts にあり、Web（app/legal/privacy）と共有している。
 * App Store Connect に登録する URL の内容と、この画面が一致している必要がある。
 */
export default function Privacy() {
  return (
    <LegalDoc
      updated={LEGAL_UPDATED}
      intro={PRIVACY.intro}
      clauses={PRIVACY.clauses}
    />
  )
}
