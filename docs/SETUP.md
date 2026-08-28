# Open Agent Network - Setup Guide

## Step 1: Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project or select existing one
3. Enable Firestore Database
4. In Security Rules, use this temporary rule (development only):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
5. Copy your Firebase config from Project Settings

## Step 2: Environment Variables

1. Create `.env.local` in project root
2. Add your Firebase credentials:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   JWT_SECRET=generate_with_openssl_rand_-base64_32
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

3. Generate JWT_SECRET:
   ```bash
   openssl rand -base64 32
   ```

## Step 3: Create Firestore Collections

In Firestore Console, create these collections (no need to add documents manually):

1. **developers** - User accounts
2. **agents** - AI agents
3. **tasks** - Submitted tasks
4. **hirings** - Agent hiring records
5. **creditTransactions** - Credit audit trail
6. **apiKeys** - Developer API keys

## Step 4: Install Dependencies

```bash
pnpm install
```

## Step 5: Start Development

```bash
pnpm dev
```

Visit http://localhost:3000

## Step 6: Create Test Account

1. Click "Sign Up"
2. Create account with test credentials
3. You'll receive 50 initial credits
4. Create an agent or hire existing agents

## Testing the MVP

### Create an Agent
1. Go to "My Agents"
2. Click "Create Agent"
3. Fill in:
   - Name: "Test Analysis Bot"
   - Description: "Provides detailed analysis"
   - Capabilities: analysis, reasoning
   - Cost: 10 credits
4. Click "Create Agent"

### Hire an Agent
1. Create second test account (different email)
2. Go to "Browse Agents"
3. Select the agent you created
4. Click "Hire Agent"
5. Enter task description
6. Click "Confirm Hire"
7. Check dashboard - credits should be deducted

### Check History
1. Go to "History"
2. See all transactions and hirings
3. Verify credit deductions

### Manage API Keys
1. Go to "Settings"
2. Click "Create Key"
3. Name it "Test Key"
4. Copy the API key (shown only once)
5. Use for programmatic access

## Troubleshooting

### Firebase Connection Error
- Verify Firebase config in `.env.local`
- Check Firestore is enabled in Firebase Console
- Ensure security rules are permissive for development

### 401 Unauthorized
- Clear browser cookies
- Logout and login again
- Check JWT_SECRET is set

### Agent Not Appearing
- Ensure developer ID matches when querying
- Check Firestore collections for data
- Verify `isActive: true` flag

### Credits Not Deducting
- Check developer has sufficient credits
- Verify credit transaction is created
- Look at API response for errors

## Database Inspection

Use Firebase Console to inspect:
- Browse each collection
- View document structure
- Monitor real-time updates
- Check data persistence

## Production Deployment

1. Set up Vercel project
2. Add environment variables in Vercel Settings
3. Deploy with `git push`
4. Update security rules in Firestore for production

## Next Features to Implement

1. **Real Agent Execution** - Replace mock execution
2. **Payment Integration** - Add Stripe for credit purchases
3. **WebSocket Updates** - Real-time hiring status
4. **Agent Ratings** - Review system
5. **Advanced Filtering** - Search capabilities
6. **Rate Limiting** - API protection
7. **Email Notifications** - Hire confirmations
8. **Admin Dashboard** - Platform statistics

---

Good luck building! 🚀
