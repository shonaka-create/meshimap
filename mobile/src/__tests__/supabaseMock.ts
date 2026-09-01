/**
 * supabase クライアントの替え玉。
 *
 * 呼び出しは .from('x').select().eq().maybeSingle() のように鎖でつながる。
 * どの段で終わるかは呼ぶ側によって違う（maybeSingle / order / single）。
 * そこで「どのメソッドを呼んでも自分を返し、await されたら結果を返す」
 * 一個の物を使う。終わり方を気にしなくてよくなる。
 */
export function makeSupabaseMock(byTable: Record<string, unknown>) {
  const chain = (table: string): unknown => {
    const result = byTable[table] ?? { data: null, error: null }
    const target: Record<string, unknown> = {
      // await されたときにここへ来る
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop as string]
        // select / eq / order / maybeSingle / single ... すべて自分を返す
        return () => chain(table)
      },
    })
  }

  return {
    from: (table: string) => chain(table),
    rpc: () => chain('__rpc'),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => chain('__storage') },
  }
}
