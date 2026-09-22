"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/work?q=${encodeURIComponent(trimmed)}` : "/work");
  };

  return (
    <form className="search-row" role="search" onSubmit={submit}>
      <Search className="search-icon" aria-hidden="true" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="search-input"
        placeholder="搜尋音樂人、作品、版本或目錄號"
        aria-label="搜尋音樂人、作品、版本或目錄號"
      />
      <Button className="search-button" type="submit">
        搜尋
      </Button>
    </form>
  );
}
