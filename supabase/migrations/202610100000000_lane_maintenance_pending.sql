ALTER TABLE public.lanes
  ADD COLUMN maintenance_pending boolean NOT NULL DEFAULT false;
