-- The founder reads feedback on /admin → Feedback (people can still only
-- send theirs, never read anyone's).
create policy "founder reads feedback" on public.feedback
  for select to authenticated using (public.is_admin());
