import { NextRequest, NextResponse } from 'next/server';
import { getCandidate, getEvidenceDocuments, proposeFact, getMerchantVertical } from '@machina/database';
import { classifyGap, extractEvidence } from '@machina/core';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { product_id, attribute_key } = body as { product_id?: string; attribute_key?: string };
  if (!product_id || !attribute_key) {
    return NextResponse.json({ error: 'product_id and attribute_key are required' }, { status: 400 });
  }

  const product = getCandidate(product_id);
  if (!product) return NextResponse.json({ error: `Unknown product ${product_id}` }, { status: 404 });

  const vertical = getMerchantVertical(product.merchant_id);
  if (!vertical) return NextResponse.json({ error: `Could not resolve a vertical for merchant ${product.merchant_id}` }, { status: 500 });

  const documents = getEvidenceDocuments(product_id);
  if (documents.length === 0) {
    return NextResponse.json({ error: `No evidence documents on file for ${product_id}` }, { status: 404 });
  }

  const { gap_type, matched_rule } = classifyGap(product, attribute_key, vertical);

  // Combine all evidence documents for this product into one pass — the extractor only
  // ever sees evidence text and the target attribute, never the held-out query set.
  const combinedText = documents.map((d) => `[${d.title}]\n${d.extracted_text}`).join('\n\n');
  const result = await extractEvidence({
    attributeKey: attribute_key,
    vertical,
    evidenceText: combinedText,
    sourceLabel: documents.map((d) => d.title).join(', '),
  });

  const factId = proposeFact({
    merchant_id: product.merchant_id,
    product_id,
    attribute_key,
    value: result.value,
    status: result.status,
    evidence_span: result.evidence_span,
    evidence_document_id: documents[0]?.id ?? null,
  });

  return NextResponse.json({ log_id: factId, gap_type, matched_rule, ...result });
}
