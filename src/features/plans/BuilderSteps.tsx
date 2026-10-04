/** The three steps of building a plan: goal, days and split, then the week. */
export default function BuilderSteps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-1.5 pt-2" role="img" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((index) => (
        <i key={index} className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-hot' : 'bg-raised'}`} />
      ))}
    </div>
  );
}
