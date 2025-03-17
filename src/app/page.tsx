import VideoList from '@/components/VideoList';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const Page: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <Card>
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Video List</h1>
            <VideoList videos={[]} />
            <Button className="mt-4">Upload Video</Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Page;