import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://adcbkcvavdurjronxhpw.supabase.co'
const supabaseKey = 'sb_publishable_jWAF8Q7CwHsMKh-bv801OQ_L00X2xzf'

export const supabase = createClient(supabaseUrl, supabaseKey)
