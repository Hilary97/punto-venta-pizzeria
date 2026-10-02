# Feature: Delete waiters and devices

Branch: `feat/delete-waiters-devices`

## Goal

Admins can permanently delete waiters and revoked order devices from `/admin/meseros`.

## Decisions

- Deleting a waiter keeps order history: `orders.waiter_id` is `on delete set null`
  and `orders.waiter_name` keeps the snapshot; the waiter's shifts cascade.
- Only revoked devices can be deleted (revoke first cuts access, delete cleans up);
  device shifts cascade; orders do not reference devices.
- Both actions require an explicit confirmation modal and are admin-only server-side.

## Tasks

- [x] 1. Migration `admin_delete_waiter`, `admin_delete_device` (revoked only) + types +
      repository functions.
- [x] 2. UI: "Eliminar" on waiter rows and revoked device rows with confirmation; tests.

## Evidence

- Task 1: `fb3b815` — tsc 0; vitest 245 green; SQL not executed.
- Task 2: `804c6e5` — RED 8 → GREEN 253; tsc 0; build 0.

## Pending (user)

- Apply the new migration in Supabase, then deploy.
