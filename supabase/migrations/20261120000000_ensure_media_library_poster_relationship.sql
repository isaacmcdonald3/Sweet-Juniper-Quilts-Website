do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_library_poster_media_library_id_fkey'
      and conrelid = 'public.media_library'::regclass
  ) then
    alter table public.media_library
      add constraint media_library_poster_media_library_id_fkey
      foreign key (poster_media_library_id)
      references public.media_library(id)
      on delete set null;
  end if;
end
$$;

notify pgrst, 'reload schema';
