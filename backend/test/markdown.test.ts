import { describe, expect, it } from 'vitest'
import { parseInline } from '../../frontend/src/components/lesson/Markdown'

describe('inline Markdown', () => {
  it('keeps backticks inside a double-backtick code span', () => {
    expect(parseInline('it might become `` `acme-analytics`.`dbt_alice`.`stg_orders` ``. With `prod`, done')).toEqual([
      'it might become ',
      { code: '`acme-analytics`.`dbt_alice`.`stg_orders`' },
      '. With ',
      { code: 'prod' },
      ', done',
    ])
  })

  it('reads underscores inside words as text, not emphasis', () => {
    expect(parseInline('join stg_orders to stg_payments')).toEqual(['join stg_orders to stg_payments'])
    expect(parseInline('an _italic_ word')).toEqual(['an ', { em: 'italic' }, ' word'])
  })

  it('still handles single backticks, bold and asterisk emphasis', () => {
    expect(parseInline('`ref()` does **two** *jobs*')).toEqual([{ code: 'ref()' }, ' does ', { strong: 'two' }, ' ', { em: 'jobs' }])
    expect(parseInline('a lone ` backtick')).toEqual(['a lone ` backtick'])
  })
})
