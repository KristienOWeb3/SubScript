import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import StartExploring from "@/components/StartExploring";

export default function Home() {
    return (
        <main className="min-h-screen">
            <Navbar />
            <Hero />
            <StartExploring />
        </main>
    );
}
