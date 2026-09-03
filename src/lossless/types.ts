/**
 * The lossless engines share the matcher's canonical types rather than keeping
 * their own copy. Two definitions of the same shape is how a fix lands in one
 * place and not the other, which already happened once with the ISRC
 * provenance flag.
 */
export * from '../matcher/types';
