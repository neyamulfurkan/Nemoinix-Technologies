const bcrypt = require('bcryptjs');

async function hashPassword() {
    const password = 'Admin@123456';
    console.log('Generating hash for password:', password);
    
    // Generate hash with explicit rounds
    const hash = await bcrypt.hash(password, 10);
    console.log('\nGenerated hash:', hash);
    
    // Test the hash immediately
    const isValid = await bcrypt.compare(password, hash);
    console.log('Hash validation test:', isValid ? '✅ PASSED' : '❌ FAILED');
    
    console.log('\n==========================================');
    console.log('Use this SQL to UPDATE the user:');
    console.log('==========================================');
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'admin@roboticsbd.com';`);
    console.log('==========================================');
}

hashPassword();