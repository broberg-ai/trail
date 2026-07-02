-- F201.8 — per-KB auto-approval threshold. NULL (default) = OFF: current
-- behaviour, every ambient capture stays pending for review. When set to a
-- number in [0,1], AMBIENT candidates (connector=trail-ambient-capture) in
-- this KB with confidence >= the threshold auto-approve unattended — the
-- distilled-knowledge path (F201.11 sets conf 0.8) becomes a Neuron with no
-- click, while noise (conf 0) stays pending. Ship-dark: existing KBs read NULL.
ALTER TABLE `knowledge_bases` ADD COLUMN `auto_approve_threshold` real;
