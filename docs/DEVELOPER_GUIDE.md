# Developer Guide - Open Agent Network

## Quick Reference

### Authentication Flow

```
User Input → Validation → Hash/JWT → Store Cookie → Redirect
```

### Hiring Flow

```
Select Agent → Enter Task → Deduct Credits → Create Hiring → Mock Execute → Update Status
```

### Data Flow

```
Frontend → API Route → Validation → Firestore → Response → UI Update
```

## Adding Features

### 1. New API Endpoint

Create file: `app/api/feature/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Your logic here

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[v0] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
```

### 2. New Database Function

Add to `lib/db.ts`:

```typescript
export async function getFeatures(developerId: string): Promise<Feature[]> {
  const q = query(
    collection(db, 'features'),
    where('developerId', '==', developerId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as Feature);
}
```

### 3. New Schema

Add to `lib/schemas.ts`:

```typescript
export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  // ... fields
});

export type Feature = z.infer<typeof FeatureSchema>;
```

### 4. New Frontend Page

Create file: `app/feature/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@/components/dashboard-layout';

export default function FeaturePage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState([]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    const response = await fetch('/api/feature');
    if (response.ok) {
      const result = await response.json();
      setData(result.data);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout>
      {/* Your UI here */}
    </DashboardLayout>
  );
}
```

## Common Patterns

### Fetch Data with Auth

```typescript
const response = await fetch('/api/resource', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

### Validate Input

```typescript
import { SomeSchema } from '@/lib/schemas';

const validated = SomeSchema.parse(body);
// TypeScript now knows type of validated
```

### Format Dates

```typescript
new Date(timestamp).toLocaleDateString()
new Date(timestamp).toLocaleTimeString()
```

### Handle Async in useEffect

```typescript
useEffect(() => {
  const fetchData = async () => {
    // async logic
  };
  
  if (user) {
    fetchData();
  }
}, [user]);
```

## Debugging

### Check Auth Token

```javascript
// In browser console
document.cookie // See 'oan-token'
```

### View API Responses

```typescript
console.log('[v0] API Response:', await response.json());
```

### Firestore Console

- Go to Firebase Console
- Click "Firestore Database"
- Browse collections and documents
- Check created_at timestamps

### Check Dev Server Logs

```bash
pnpm dev
# Watch terminal for [v0] debug messages
```

## Performance Tips

1. **Pagination** - Limit Firestore queries
   ```typescript
   limit(50) // Get first 50 docs
   ```

2. **Indexing** - Create indexes for complex queries
   ```typescript
   orderBy('createdAt', 'desc') // Create index in Firebase
   ```

3. **Caching** - Use React state or SWR
   ```typescript
   const { data } = useSWR('/api/data', fetcher);
   ```

## Security Checklist

- [ ] Validate all inputs with Zod
- [ ] Check user owns resource before modifying
- [ ] Use HTTP-only cookies for auth
- [ ] Hash passwords with bcryptjs
- [ ] Verify JWT tokens before processing
- [ ] Never log sensitive data
- [ ] Use environment variables for secrets
- [ ] Set proper CORS headers if needed

## Testing Checklist

- [ ] Create account with valid email
- [ ] Create account with invalid email (should fail)
- [ ] Login with wrong password (should fail)
- [ ] Create agent with 0 cost (should fail)
- [ ] Hire agent with insufficient credits (should fail)
- [ ] Hire agent with sufficient credits (should succeed)
- [ ] Check credits deducted immediately
- [ ] View transaction in history
- [ ] Create API key and view it (only once!)
- [ ] Revoke API key

## API Key Management

### Generate API Key

```typescript
const apiKey = generateApiKey(); // 'oan_' + random hex
const keyHash = await hashApiKey(apiKey);
```

### Use API Key in Requests

```bash
curl -X POST http://localhost:3000/api/hirings \
  -H "x-api-key: oan_..." \
  -H "x-developer-id: dev_..." \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## Error Handling

```typescript
try {
  // operation
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation
  } else if (error instanceof FirebaseError) {
    // Handle Firebase
  } else {
    // Generic error
  }
}
```

## Rate Limiting (Future)

```typescript
// Placeholder for rate limiting middleware
// Future: Add Upstash Redis integration
```

## Monitoring (Future)

```typescript
// Placeholder for monitoring
// Future: Add Sentry integration
```

## Useful Commands

```bash
# Start dev server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run linter
pnpm lint

# Generate JWT secret
openssl rand -base64 32

# List Firebase projects
firebase projects:list
```

## File Size Limits

- Agent description: 500 chars
- Task input: 10KB
- API key name: 50 chars

## Typical Request/Response

### POST /api/agents

Request:
```json
{
  "name": "String",
  "description": "String",
  "capabilities": ["String"],
  "costPerExecution": 10
}
```

Response (201):
```json
{
  "message": "Agent created successfully",
  "agentId": "agent_abc123"
}
```

## Environment Variables

```env
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Auth
JWT_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Troubleshooting

### "Firebase Error: auth/invalid-api-key"
- Check Firebase credentials in `.env.local`
- Ensure all Firebase env vars are set
- Restart dev server

### "Unauthorized: Invalid token"
- Clear browser cookies
- Login again
- Check JWT_SECRET is set

### "Agent not found"
- Check agent exists in Firestore
- Verify developerId matches
- Check isActive flag is true

### "Insufficient credits"
- Check developer balance
- Verify agent cost is less than balance
- Check credit deduction in history

## Next Developer

If you're continuing this project:

1. Read IMPLEMENTATION_SUMMARY.md for overview
2. Read SETUP.md for Firebase setup
3. Run `pnpm dev` and test the app
4. Read this guide for patterns
5. Start in `lib/` for backend logic
6. Build in `app/` for frontend
7. Reference `/api/` for patterns

Good luck! 🚀

---

Questions? Check the existing code - patterns are consistent throughout.
