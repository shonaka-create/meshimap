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
    // エラーを検知したら即リロード
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-50">
          <div className="text-center">
            <span className="text-5xl">🍜</span>
            <p className="text-gray-500 mt-3 text-sm">再読み込み中...</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
