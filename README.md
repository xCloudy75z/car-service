# 🔩 Car Service History

## What it is
A timeline of every service, repair, and replacement your car has had — what was done, when, at what mileage, for how much.

## The problem it solves
"When was the last oil change?" — nobody remembers. Dealership apps are brand-locked and useless if you switch workshops. Resale value drops without a complete service history.

## Core MVP features
- Add service entry: date, odometer, service type (oil, tires, brakes, etc.), workshop, cost, notes
- Timeline view (newest first)
- "Next due" predictions for common services (oil every 10k km, etc.)
- Total spent per year
- Search/filter by service type

## Why people use it
Reference before every workshop visit ("did they already do the brake pads?"). Critical when selling the car — full service records add significant resale value.

## Tech notes
- Single-page HTML/CSS/JS
- localStorage for persistence
- Offline-first, no login
- Mobile-first
- Deploy: Netlify / Vercel / GitHub Pages

## Difficulty
Very Easy — ~2 hours of build time.

## Future upgrades (not MVP)
- Photo attachment for invoices
- Multiple vehicles
- Export to PDF (for handover to buyer)
- Custom "next due" rules per service
