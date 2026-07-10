"use client";

/* The dashboard subdomain rewrites /dashboard/user/* -> /user/* (see middleware), so the
   canonical served path for the transactions page is /user/transactions. The implementation
   lives under dashboard/user/transactions; re-export it here so the rewrite target resolves
   instead of 404ing. Mirrors src/app/user/page.tsx. */
export { default } from "../../dashboard/user/transactions/page";
