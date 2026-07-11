import { describe, expect, it } from "vitest"
import { openScienceTopicEntries } from "@/components/demo/topic-policy"

describe("demo topic policy presentation", () => {
  it("shows the four community priorities without leaking unrelated production topics", () => {
    const entries = openScienceTopicEntries({
      topicWeights: {
        "science-research": 0.9,
        "data-science": 0.85,
        "software-development": 0.55,
        "open-source": 0.8,
        music: 0.2,
        "decentralized-social": 0.4,
      },
    })

    expect(entries).toEqual([
      ["science-research", 0.9],
      ["data-science", 0.85],
      ["software-development", 0.55],
      ["open-source", 0.8],
    ])
  })
})
