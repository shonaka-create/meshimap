'use client'

import { Component, type ReactNode } from 'react'

interface State { hasError: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    // 即リロードしない（無限ループになるため）
    // hasError = true の画面を表示してユーザーに委ねる
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-50">
          <div className="text-center">
            <span className="text-5xl">🍜</span>
            <p className="text-gray-500 mt-3 text-sm">エラーが発生しました</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-400 to-rose-500 text-white text-sm font-semibold rounded-xl"
            >
              再読み込み
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
