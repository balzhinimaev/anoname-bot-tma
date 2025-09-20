const fs = require('fs');
const path = require('path');

// Simple broadcast script to send messages to all users
// Usage: node broadcast.js "Your message here"

const USER_IDS_FILE = path.join(__dirname, 'user_ids.txt');

async function readUserIds() {
  try {
    const content = fs.readFileSync(USER_IDS_FILE, 'utf-8');
    const ids = content.trim().split('\n').filter(id => id.trim() !== '');
    return ids;
  } catch (error) {
    console.error('Error reading user IDs file:', error.message);
    return [];
  }
}

function main() {
  const message = process.argv[2];
  
  if (!message) {
    console.log('Usage: node broadcast.js "Your message here"');
    console.log('Example: node broadcast.js "Привет! У нас новая функция!"');
    process.exit(1);
  }

  const userIds = readUserIds();
  
  console.log(`Found ${userIds.length} users:`);
  userIds.forEach((id, index) => {
    console.log(`${index + 1}. ${id}`);
  });
  
  console.log(`\nMessage to send: "${message}"`);
  console.log('\nTo actually send messages, you would need to implement Telegram API calls.');
  console.log('This script only shows the user IDs for now.');
}

main();
