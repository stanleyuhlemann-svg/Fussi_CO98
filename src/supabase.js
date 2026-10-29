import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://adcbkcvavdurjronxhpw.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseKey) {
  throw new Error('Der Supabase Publishable Key fehlt.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
