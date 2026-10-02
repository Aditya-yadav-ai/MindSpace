CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;
ALTER EXTENSION vector SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 6,
  similarity_threshold DOUBLE PRECISION DEFAULT 0.15
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  document_title TEXT,
  chunk_index INTEGER,
  content TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title AS document_title,
    c.chunk_index,
    c.content,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.user_id = auth.uid()
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) > similarity_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(extensions.vector, INTEGER, DOUBLE PRECISION) TO authenticated;