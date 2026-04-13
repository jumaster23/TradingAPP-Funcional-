import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReactMarkdown from 'react-markdown';

export default function InfoModal({ open, onClose, title, content }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">{title || 'Información'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-2 text-sm text-muted-foreground prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{content || 'No hay información disponible.'}</ReactMarkdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}