import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.local.');
  console.log('\nPlease ensure you are using the correct Supabase instance (tempo, not flashcardapp).');
  console.log('You can find the Service Role Key in the Supabase Dashboard -> Project Settings -> API.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TARGET_EMAIL = 'bruce788982@gmail.com';

const CATEGORY_PALETTE = [
  '#f87171', // red-400
  '#fb923c', // orange-400
  '#fbbf24', // amber-400
  '#a3e635', // lime-400
  '#4ade80', // green-400
  '#2dd4bf', // teal-400
  '#38bdf8', // sky-400
  '#818cf8', // indigo-400
  '#c084fc', // purple-400
  '#f472b6', // pink-400
];

async function run() {
  console.log(`Looking up user by email: ${TARGET_EMAIL}...`);

  // We need the admin auth API to list users since we only have the email
  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
  
  if (usersErr) {
    console.error('Error fetching users:', usersErr.message);
    process.exit(1);
  }

  const user = usersData.users.find(u => u.email === TARGET_EMAIL);
  if (!user) {
    console.error(`User with email ${TARGET_EMAIL} not found in Supabase Auth.`);
    process.exit(1);
  }

  const ownerId = user.id;
  console.log(`Found user! ID: ${ownerId}`);

  // We will assume "selection" means categories in this context,
  // as categories have color codes and act as selections for events.
  
  console.log('Clearing current categories for the user...');
  const { error: deleteErr } = await supabase
    .from('categories')
    .delete()
    .eq('owner_id', ownerId);

  if (deleteErr) {
    console.error('Error deleting categories:', deleteErr.message);
    process.exit(1);
  }
  
  console.log('Current categories cleared successfully.');

  console.log('Inserting placeholder categories with colors...');
  
  const placeholders = [
    { name: 'Work', color: CATEGORY_PALETTE[0], owner_id: ownerId, sort_order: 1 },
    { name: 'Personal', color: CATEGORY_PALETTE[7], owner_id: ownerId, sort_order: 2 },
    { name: 'Health', color: CATEGORY_PALETTE[4], owner_id: ownerId, sort_order: 3 },
    { name: 'Hobbies', color: CATEGORY_PALETTE[2], owner_id: ownerId, sort_order: 4 },
  ];

  const { error: insertErr } = await supabase
    .from('categories')
    .insert(placeholders);

  if (insertErr) {
    console.error('Error inserting placeholder categories:', insertErr.message);
    process.exit(1);
  }

  console.log('Placeholder categories created successfully!');
  console.log('All done. The selections have been updated on the tempo Supabase instance.');
}

run();
