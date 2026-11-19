// Tests : base en mémoire, rien n'est écrit dans backend/data.
process.env.DATA_DIR ??= ':memory:';
