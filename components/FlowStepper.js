export default function FlowStepper({ currentStep = 1, steps = [] }) {
  const cx = (...classes) => classes.filter(Boolean).join(' ');

  return (
    <div className="flex items-center gap-3 text-sm font-semibold text-gray-700">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === currentStep;
        const completed = number < currentStep;

        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cx(
                'w-9 h-9 rounded-full flex items-center justify-center border text-sm',
                completed && 'bg-green-100 text-green-700 border-green-200',
                active && !completed && 'bg-blue-100 text-blue-700 border-blue-200',
                !active && !completed && 'bg-gray-100 text-gray-600 border-gray-200'
              )}
            >
              {number}
            </div>
            <span className={cx('whitespace-nowrap', active && 'text-blue-700', completed && 'text-green-700')}>
              {step}
            </span>
            {index < steps.length - 1 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        );
      })}
    </div>
  );
}
