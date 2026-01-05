# 🤖 Bangladesh Robotics Marketplace

Bangladesh's first comprehensive robotics marketplace platform connecting university robotics clubs with students.

## 🌟 Features

- **Marketplace**: Buy/sell robotics components
- **Competitions**: Organize and register for robotics competitions
- **Club Profiles**: Branded mini-websites for each club
- **Gamified Rewards**: Tier-based system with Bronze, Silver, Gold, Platinum badges
- **Competition-Component Integration**: Direct purchase of required components

## 🚀 Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (Neon)
- **File Storage**: Cloudinary
- **Deployment**: Render

## 📦 Installation

1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/nemoinix.git
cd nemoinix
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Set up database
- Create a Neon PostgreSQL database
- Run the schema: `backend/db/schema.sql`

5. Start the server
```bash
npm start
```

## 🌐 Live Demo

- **Website**: https://nemoinix.onrender.com
- **API**: https://nemoinix.onrender.com/api

## 📧 Contact

Support: support@roboticsbd.com

## 📄 License

MIT License
```

---

## 📋 **PHASE 2: Set Up Neon PostgreSQL Database**

### Step 1: Create Neon Account & Database

1. Go to **https://neon.tech**
2. Click **"Sign Up"** (use GitHub to sign in for easy integration)
3. After logging in, click **"Create Project"**
4. Fill in:
   - **Project Name**: `nemoinix-db`
   - **Database Name**: `robotics_marketplace`
   - **Region**: Choose closest to your users (e.g., AWS Singapore for Bangladesh)
   - **Postgres Version**: 16 (latest)
5. Click **"Create Project"**

### Step 2: Get Database Credentials

After creation, you'll see a connection string like:
```
postgresql://username:password@ep-cool-name-123456.us-east-2.aws.neon.tech/robotics_marketplace?sslmode=require