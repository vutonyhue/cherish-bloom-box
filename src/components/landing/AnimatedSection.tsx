import { cn } from "@/lib/utils";
import useScrollAnimation from "@/hooks/useScrollAnimation";

type AnimationType = 
  | "fade-in-up" 
  | "fade-in-left" 
  | "fade-in-right" 
  | "scale-in" 
  | "bounce-in";

interface AnimatedSectionProps {
  children: React.ReactNode;
  animation?: AnimationType;
  delay?: number;
  className?: string;
  threshold?: number;
}

const AnimatedSection = ({
  children,
  animation = "fade-in-up",
  delay = 0,
  className,
  threshold = 0.1,
}: AnimatedSectionProps) => {
  const { ref, isVisible } = useScrollAnimation({ threshold });

  const animationClass = {
    "fade-in-up": "animate-fade-in-up",
    "fade-in-left": "animate-fade-in-left",
    "fade-in-right": "animate-fade-in-right",
    "scale-in": "animate-scale-in",
    "bounce-in": "animate-bounce-in",
  }[animation];

  return (
    <div
      ref={ref}
      className={cn(
        "opacity-0",
        isVisible && animationClass,
        className
      )}
      style={{
        animationDelay: isVisible ? `${delay}ms` : "0ms",
      }}
    >
      {children}
    </div>
  );
};

export default AnimatedSection;
