export default function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t bg-gray-50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
