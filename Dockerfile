FROM adrianmusante/pocketbase

COPY build/dist/. /pocketbase/public/
COPY pb_migrations/. /pocketbase/migrations/
COPY pb_hooks/. /pocketbase/hooks/
