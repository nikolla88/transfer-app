import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Login() {
  const { session } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm">
        <div className="card p-8">
          <div className="text-center mb-8">
            <div className="text-4xl mb-2">🚗</div>
            <h1 className="text-xl font-bold text-gray-900">Transfer App</h1>
            <p className="text-sm text-gray-500 mt-1">Montenegro Transfers</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="input" placeholder="email@firma.com"
              />
            </div>
            <div>
              <label className="label">Lozinka</label>
              <input
                type="password" required value={password}
                onChange={e => setPassword(e.target.value)}
                className="input" placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2">
              {loading ? 'Prijava...' : 'Prijava'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
