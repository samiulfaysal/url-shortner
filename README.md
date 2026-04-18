# Codorax Link - Multi-User URL Shortener

A professional, enterprise-grade URL shortening platform built on Cloudflare Workers with JWT authentication, real-time analytics, and admin dashboard.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Neon PostgreSQL database

### Installation

```bash
# 1. Clone and install dependencies
npm install

# 2. Set up environment secrets
wrangler secret put DATABASE_URL
wrangler secret put JWT_SECRET

# 3. Run database schema
# Copy schema.sql to your Neon console and execute

# 4. Development server
npm run dev

# 5. Deploy to Cloudflare
npm run deploy
```

## 📋 Features

### User Management
- **Signup/Login** with bcryptjs password hashing
- **JWT Authentication** with HTTP-only cookies
- **Role-based Access Control** (user/admin)
- **Secure Sessions** (7-day token expiration)

### URL Shortening
- **6-character slugs** for easy sharing
- **Analytics tracking** (IP, User-Agent, timestamp)
- **User association** (links linked to user accounts)
- **Non-blocking** analytics collection
- **301 redirects** for SEO optimization

### Admin Dashboard
- **Real-time statistics** (users, links, clicks)
- **User management** interface
- **Daily click trends** with Chart.js
- **30-second auto-refresh** for live updates

### API
- RESTful endpoints with JSON responses
- JWT token-based authentication
- Comprehensive error handling
- Input validation with Zod schemas

## 🎨 Design System

**Glassmorphism UI** with:
- Backdrop blur effects
- Mesh gradient backgrounds
- Semi-transparent cards with borders
- Smooth animations and transitions
- Responsive mobile design
- Dark theme optimized for the eye

## 📁 Project Structure

```
├── src/
│   ├── index.ts          # Main Hono app with all routes
│   ├── auth.ts           # JWT & password handling
│   └── db.ts             # Database connection helper
├── public/
│   ├── index.html        # URL shortener UI
│   ├── login.html        # Auth UI (signup/login)
│   ├── admin.html        # Admin dashboard
│   └── profile.html      # User profile (future)
├── schema.sql            # PostgreSQL schema
├── package.json          # Dependencies
├── wrangler.toml         # Cloudflare Workers config
└── tsconfig.json         # TypeScript config
```

## 🔐 Security

✅ **Password Security**
- Bcrypt hashing with 10 salt rounds
- Never store plain text passwords

✅ **JWT Security**
- HS256 algorithm
- 7-day expiration
- HTTP-only cookies prevent XSS

✅ **Data Protection**
- SQL injection prevention via parameterized queries
- CSRF protection with SameSite cookie flag
- Role-based access control for admin routes

✅ **Analytics Privacy**
- IP addresses stored as SHA-256 hashes
- Anonymous analytics for non-authenticated users

## 📊 Database Schema

### Users Table
```sql
id UUID PRIMARY KEY,
email VARCHAR(255) UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
role VARCHAR(50) DEFAULT 'user',
created_at TIMESTAMP
```

### Links Table
```sql
id SERIAL PRIMARY KEY,
slug VARCHAR(10) UNIQUE NOT NULL,
original_url TEXT NOT NULL,
user_id UUID REFERENCES users(id),
clicks INTEGER DEFAULT 0,
created_at TIMESTAMP
```

### Analytics Table
```sql
id SERIAL PRIMARY KEY,
link_id INTEGER REFERENCES links(id),
ip_hash VARCHAR(64) NOT NULL,
user_agent TEXT,
created_at TIMESTAMP
```

## 🛣️ API Routes

### Authentication
```
POST   /auth/signup          Register new user
POST   /auth/login           Login user
POST   /auth/logout          Logout user
```

### URL Management
```
POST   /shorten              Create short link
GET    /:slug                Redirect to original URL
```

### User Dashboard
```
GET    /api/user/history     Get user's links (auth required)
```

### Admin Dashboard
```
GET    /api/admin/stats      Get platform statistics (admin only)
GET    /api/admin/users      List all users (admin only)
```

## 🧪 Type Safety

- Full TypeScript support
- Zod schema validation for all inputs
- Proper typing for Hono context and middleware
- No `@ts-ignore` directives (production ready!)

## 🚢 Deployment

### Cloudflare Workers
```bash
npm run deploy
```

### Environment Setup
Before deploying, set these secrets:
```bash
# Required
wrangler secret put DATABASE_URL
wrangler secret put JWT_SECRET

# Generated URLs like:
DATABASE_URL=postgresql://user:password@host/dbname
JWT_SECRET=your-random-secret-min-32-chars
```

## 📈 Performance

- **Response Time**: <100ms for URL redirects
- **Database Queries**: Indexed for O(1) slug lookups
- **Concurrent Connections**: Unlimited (serverless)
- **Analytics**: Non-blocking (no latency impact)
- **Scalability**: Horizontal via Cloudflare edge network

## 🎯 Use Cases

✅ Social media link shortening
✅ Email campaign tracking
✅ QR code generation (extension)
✅ API documentation links
✅ Meeting room short URLs
✅ Event registration links

## 🔄 Workflow

### For End Users
1. Visit /login.html to signup/login
2. Visit / to create short links
3. Share short links with analytics tracking

### For Admins
1. Visit /admin.html to view dashboard
2. Monitor real-time platform statistics
3. Manage user accounts
4. View click trends

## 🛠️ Development

### Type Checking
```bash
npm run type-check
```

### Development Mode
```bash
npm run dev
# Server runs on http://localhost:8787
```

### Build
```bash
npm run deploy
```

## 📝 Configuration

### wrangler.toml
```toml
name = "url-shortner"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
# DATABASE_URL and JWT_SECRET are secrets, not vars

[assets]
directory = "./public"
```

## 🐛 Debugging

### Enable Debug Logging
```typescript
// In src/index.ts
console.debug('Debug message');
```

### View Logs
```bash
wrangler tail
```

### Local Testing
```bash
npm run dev
# Test endpoints on http://localhost:8787
```

## 📚 Resources

- [Hono Documentation](https://hono.dev)
- [Neon PostgreSQL](https://neon.tech)
- [Cloudflare Workers](https://developers.cloudflare.com/workers)
- [JWT Guide](https://jwt.io)
- [Zod Validation](https://zod.dev)

## 📄 License

ISC

## 🤝 Contributing

This is a complete, production-ready application. All core features are implemented.

---

**Status**: ✅ Production Ready
**Last Updated**: April 18, 2026
**TypeScript Errors**: 0
