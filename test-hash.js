const bcrypt = require('bcryptjs');

const password = 'Admin@12345';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Password:', password);
    console.log('Hash:', hash);
    console.log('\n=== Copy this SQL ===');
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'admin@roboticsbd.com';`);
    
    // Test the hash
    bcrypt.compare(password, hash, (err, result) => {
      console.log('\nHash validation:', result ? '✅ VALID' : '❌ INVALID');
    });
  }
});