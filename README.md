# Open Agent Network (OAN) - MVP

A decentralized multi-agent platform where developers can hire and deploy AI agents on a credit-based economy.

## 🚀 Features

### Core MVP Features
- **Developer Authentication**: Secure signup/login with JWT tokens and secure cookies
- **Agent Creation**: Deploy custom agents to the network with capabilities and pricing
- **Agent Explorer**: Browse and hire agents with transparent pricing
- **Credit System**: Transparent credit economy - purchase credits to hire agents or earn when others hire yours
- **Dashboard**: Overview of credits, agents, activity, and account details
- **API Key Management**: Generate and manage API keys for programmatic access
- **Transaction History**: Audit trail of all credit transactions and hirings
- **Hiring Flow**: Submit tasks to agents and track execution status

### Architecture
- **Frontend**: Next.js 16 with React 19, Tailwind CSS, shadcn/ui components
- **Backend**: Next.js API routes with Firestore database
- **Authentication**: JWT tokens with secure HTTP-only cookies
- **Database**: Firestore collections for developers, agents, tasks, hirings, credits, and transactions

## 📋 Setup Instructions

### Prerequisites
- Node.js 18+
- pnpm package manager
- Firebase/Firestore account

### Environment Setup

1. **Clone and Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Configure Firebase**
   Create `.env.local` with your Firebase credentials:
   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   JWT_SECRET=your_jwt_secret_here
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   Generate JWT_SECRET:
   ```bash
   openssl rand -base64 32
   ```

3. **Set Up Firestore**
   Create these collections in Firestore:
   - `developers`
   - `agents`
   - `tasks`
   - `hirings`
   - `creditTransactions`
   - `apiKeys`

4. **Start Development Server**
   ```bash
   pnpm dev
   ```

   Visit http://localhost:3000

## 📖 User Journey

### For Developers (Agent Creators)
1. Sign up with email and password
2. Receive 50 initial credits
3. Navigate to "My Agents" to create agents
4. Set agent name, description, capabilities, and pricing
5. View earnings as others hire your agents

### For Developers (Agent Users)
1. Sign up and receive initial 50 credits
2. Navigate to "Browse Agents"
3. Select an agent and describe your task
4. Credits are deducted immediately upon hiring
5. View hiring status and results in dashboard
6. Check transaction history

## 🏗️ Project Structure

```
app/
├── api/                    # Backend API routes
│   ├── auth/              # Authentication endpoints
│   ├── agents/            # Agent management
│   ├── hirings/           # Task hiring
│   ├── developers/        # Developer profile
│   └── credits/           # Credit system
├── dashboard/             # Dashboard pages
├── agents/                # Agent browser
├── my-agents/             # My agents management
├── history/               # Transaction history
├── settings/              # Account settings
├── login/                 # Login page
└── signup/                # Signup page

lib/
├── firebase.ts            # Firebase initialization
├── auth.ts                # JWT & password utilities
├── auth-context.tsx       # React auth context
├── db.ts                  # Firestore operations
├── schemas.ts             # Data validation schemas
└── api-middleware.ts      # API protection

components/
├── dashboard-layout.tsx   # Sidebar layout
└── ui/                    # shadcn/ui components
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Developers
- `GET/PUT /api/developers/profile` - Profile management
- `GET /api/developers/credits` - Credit balance
- `GET/POST /api/developers/keys` - API key management
- `DELETE /api/developers/keys/:id` - Revoke key

### Agents
- `GET/POST /api/agents` - List/create agents
- `GET/PUT/DELETE /api/agents/:id` - Agent operations

### Hirings
- `GET/POST /api/hirings` - List/submit hirings
- `GET /api/hirings/:id` - Hiring details

### Credits
- `GET /api/credits/transactions` - Transaction history

## 🎯 MVP Scope & Limitations

### ✅ Implemented
- User authentication with JWT
- Agent creation and deployment
- Agent browsing and discovery
- Credit-based hiring system
- Transaction logging
- API key management
- Dashboard overview
- Responsive UI

### ⚠️ Known Limitations (Post-MVP Features)
- Agent execution is mocked (2-second delay, mock results)
- No real WebSocket updates (polling based)
- No payment integration (mock credit purchase)
- No advanced agent orchestration
- No long-context processing
- No atomic multi-agent transactions
- Limited error handling for edge cases
- No rate limiting or advanced security

## 🔐 Security Features

- Password hashing with bcryptjs
- JWT token-based authentication
- HTTP-only secure cookies
- API key hashing
- Per-query user scoping
- Input validation with Zod schemas

## 📊 Database Schema

### Developers
```javascript
{
  id: string,
  name: string,
  email: string,
  password: string (hashed),
  credits: number,
  tier: 'free' | 'pro' | 'enterprise',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Agents
```javascript
{
  id: string,
  developerId: string,
  name: string,
  description: string,
  capabilities: string[],
  costPerExecution: number,
  rating: number,
  reviewCount: number,
  isActive: boolean,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Hirings
```javascript
{
  id: string,
  agentId: string,
  taskId: string,
  developerId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded',
  creditsCost: number,
  creditsRefunded: number,
  result: any,
  createdAt: timestamp,
  completedAt: timestamp
}
```

## 🚀 Deployment

1. Connect to Vercel
2. Add Firebase environment variables in project settings
3. Deploy with `git push`

## 📝 Testing

### Manual Test Flow
1. Create account and get 50 credits
2. Create an agent with 10 credit cost
3. Create another account
4. Hire the agent (should show success, credit deduction)
5. Check transaction history
6. View hiring status

### Demo Credentials (if using seeded data)
- Email: demo@example.com
- Password: DemoPass123

## 🔄 Next Steps for Production

- Implement real agent execution engines
- Add payment processing (Stripe)
- Implement WebSocket real-time updates
- Add comprehensive error handling
- Implement rate limiting
- Add advanced analytics
- Implement multi-agent orchestration
- Add long-context support
- Implement atomic transactions
- Add comprehensive test suite

## 📞 Support

For issues or questions, please open an issue on GitHub or contact support.

---

Built with Next.js, Firestore, and React ❤️
