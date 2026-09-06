# BAN Smart Money — Setup Guide

## Prerequisites

- Node.js 18+
- pnpm 8+
- Firebase project with Firestore enabled
- Inngest account (inngest.com)
- Vercel account (for deployment)

## Step 1: Clone & Install

```bash
git clone <repo-url>
cd open-agent-network
pnpm install
```

## Step 2: Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project or select existing one
3. Enable Firestore Database
4. Enable Firebase Authentication (Email/Password)
5. Generate a service account key (Project Settings → Service Accounts → Generate New Private Key)
6. Copy the service account JSON values into `.env.local`

## Step 3: Inngest Setup

1. Go to [Inngest](https://inngest.com) and create an account
2. Create a new project
3. Copy the Signing Key and Event Key into `.env.local`

## Step 4: Environment Configuration

Create `apps/web/.env.local`:

```env
# Firebase Admin SDK (server-side)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Firebase Client SDK (browser)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id

# Inngest
INNGEST_SIGNING_KEY=your-signing-key
INNGEST_EVENT_KEY=your-event-key

# AI (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-key

# Blockchain
BAN_RPC_URL=https://bsc-dataseed.binance.org/
BAN_CHAIN_ID=56
BAN_LIVE_DATA=1

# Altana (optional for hackathon)
ALTANA_API_KEY=your-altana-key
```

## Step 5: Firestore Collections

The following collections are created automatically by the application:

- `users`, `agents`, `agent_sessions`, `agent_permissions`, `strategies`
- `action_proposals`, `executions`, `jobs`, `spend_ledger`, `positions`
- `market_data`, `performance`, `audit_events`, `agent_events`
- `protocol_configs`, `agent_tasks`, `agent_keystores`

See `firestore/firestore.rules` for security rules.

## Step 6: Run Locally

```bash
# Start development server (Next.js + Inngest)
pnpm dev

# The Inngest dev server will be available at http://localhost:3000/api/inngest
```

## Step 7: Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
```

## Step 8: Verify

1. Open the deployed URL
2. Sign up for a new account
3. Browse the marketplace (`/agents`)
4. Check the dashboard (`/dashboard`)

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
cd packages/eip7702 && pnpm test
cd packages/policy-engine && pnpm test
cd packages/execution-engine && pnpm test
```

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
