# Mustakileen — Freelance Services Platform (Freelancer 360)

A full-stack, bilingual (English/Arabic) freelance-services platform shipped for a real client. This repository is a monorepo containing the front end, the REST API, and the project's design documentation.

**Live:** https://frontend-project-ed-xrvo.vercel.app

## Repository layout

| Path | What it is |
| --- | --- |
| `Frontend/` | React + TypeScript single-page app (Vite) |
| `backend/` | Node.js + Express REST API with MongoDB |
| `docs/` | SRS, requirements, architecture and database design (ERD) |

## Frontend

- React 19 + TypeScript, bundled with Vite
- State and data: Zustand, TanStack Query, Axios
- Forms and validation: React Hook Form + Zod
- UI: Tailwind CSS, Framer Motion, Lucide icons, full RTL/Arabic support

## Backend

- Express with MongoDB (Mongoose models)
- JWT authentication with bcryptjs password hashing
- Security middleware: Helmet, CORS, express-rate-limit, express-validator
- Transactional email via Nodemailer / Resend
- Seed scripts and test fixtures under `backend/seeds` and `backend/scripts`

## Getting started

```bash
# API
cd backend
npm install
# copy .env.example / configure MONGODB_URI, JWT secret and mail keys
npm run dev

# Front end
cd Frontend
npm install
npm run dev
```

## Documentation

The `docs/` folder contains the full requirement and architecture set: software requirements specification, functional and non-functional requirements, acceptance criteria, error-handling matrix, and the database ERD (`Frontend/freelancer_platform_erd.html`).
