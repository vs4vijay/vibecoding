from typing import Dict, Optional
from enum import Enum
import asyncio
from ..config import settings
from ..utils import get_logger

logger = get_logger(__name__)


class SentimentLabel(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"


class SentimentResult:
    def __init__(
        self,
        label: SentimentLabel,
        score: float,
        confidence: float,
        provider: str,
        model_name: Optional[str] = None
    ):
        self.label = label
        self.score = score
        self.confidence = confidence
        self.provider = provider
        self.model_name = model_name


class SentimentAnalyzer:
    def __init__(self):
        self.provider = settings.sentiment_provider
        self._local_model = None
        self._local_tokenizer = None
        self._openai_client = None
        self._anthropic_client = None
        self._model_loaded = False

    def _ensure_loaded(self):
        if self._model_loaded:
            return
        self._model_loaded = True
        
        if self.provider == "local":
            self._load_local_model()
        elif self.provider == "openai" and settings.openai_api_key:
            from openai import AsyncOpenAI
            self._openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
        elif self.provider == "anthropic" and settings.anthropic_api_key:
            from anthropic import AsyncAnthropic
            self._anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    @property
    def local_model(self):
        self._ensure_loaded()
        return self._local_model

    @property
    def local_tokenizer(self):
        self._ensure_loaded()
        return self._local_tokenizer

    @property
    def openai_client(self):
        self._ensure_loaded()
        return self._openai_client

    @property
    def anthropic_client(self):
        self._ensure_loaded()
        return self._anthropic_client

    def _load_local_model(self):
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        
        try:
            logger.info(f"Loading local sentiment model: {settings.local_model_name}")
            self._local_tokenizer = AutoTokenizer.from_pretrained(settings.local_model_name)
            self._local_model = AutoModelForSequenceClassification.from_pretrained(
                settings.local_model_name
            )
            self._local_model.eval()
            logger.info("Local model loaded successfully")
        except Exception as e:
            logger.error(f"Error loading local model: {e}")
            raise

    async def analyze(self, text: str) -> SentimentResult:
        if self.provider == "local":
            return await self._analyze_local(text)
        elif self.provider == "openai":
            return await self._analyze_openai(text)
        elif self.provider == "anthropic":
            return await self._analyze_anthropic(text)
        else:
            logger.warning(f"Unknown provider: {self.provider}, falling back to local")
            return await self._analyze_local(text)

    async def _analyze_local(self, text: str) -> SentimentResult:
        try:
            return await asyncio.to_thread(self._run_inference, text)
        except Exception as e:
            logger.error(f"Error in local sentiment analysis: {e}")
            return SentimentResult(
                label=SentimentLabel.NEUTRAL,
                score=0.5,
                confidence=0.0,
                provider="local",
                model_name=settings.local_model_name
            )

    def _run_inference(self, text: str) -> SentimentResult:
        import torch
        
        try:
            inputs = self.local_tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True
            )

            with torch.no_grad():
                outputs = self.local_model(**inputs)
                predictions = torch.nn.functional.softmax(outputs.logits, dim=-1)

            scores = predictions[0].tolist()
            labels = ["positive", "negative", "neutral"]

            if "finbert" in settings.local_model_name.lower():
                labels = ["positive", "negative", "neutral"]

            max_idx = scores.index(max(scores))
            label = SentimentLabel(labels[max_idx])
            confidence = scores[max_idx]

            score = self._normalize_score(label, confidence)

            return SentimentResult(
                label=label,
                score=score,
                confidence=confidence,
                provider="local",
                model_name=settings.local_model_name
            )
        except Exception as e:
            logger.error(f"Error in local sentiment analysis: {e}")
            return SentimentResult(
                label=SentimentLabel.NEUTRAL,
                score=0.5,
                confidence=0.0,
                provider="local",
                model_name=settings.local_model_name
            )

    async def _analyze_openai(self, text: str) -> SentimentResult:
        try:
            prompt = f"""Analyze the sentiment of this financial news article and classify it as positive, negative, or neutral for stock market implications.

Article: {text[:1000]}

Respond in JSON format:
{{"sentiment": "positive/negative/neutral", "confidence": 0.0-1.0, "reasoning": "brief explanation"}}"""

            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1
            )

            import json
            result = json.loads(response.choices[0].message.content)

            label = SentimentLabel(result["sentiment"])
            confidence = float(result["confidence"])
            score = self._normalize_score(label, confidence)

            return SentimentResult(
                label=label,
                score=score,
                confidence=confidence,
                provider="openai",
                model_name="gpt-4o-mini"
            )
        except Exception as e:
            logger.error(f"Error in OpenAI sentiment analysis: {e}")
            return SentimentResult(
                label=SentimentLabel.NEUTRAL,
                score=0.5,
                confidence=0.0,
                provider="openai"
            )

    async def _analyze_anthropic(self, text: str) -> SentimentResult:
        try:
            prompt = f"""Analyze the sentiment of this financial news article and classify it as positive, negative, or neutral for stock market implications.

Article: {text[:1000]}

Respond in JSON format:
{{"sentiment": "positive/negative/neutral", "confidence": 0.0-1.0, "reasoning": "brief explanation"}}"""

            response = await self.anthropic_client.messages.create(
                model="claude-3-5-haiku-20241022",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )

            import json
            result = json.loads(response.content[0].text)

            label = SentimentLabel(result["sentiment"])
            confidence = float(result["confidence"])
            score = self._normalize_score(label, confidence)

            return SentimentResult(
                label=label,
                score=score,
                confidence=confidence,
                provider="anthropic",
                model_name="claude-3-5-haiku-20241022"
            )
        except Exception as e:
            logger.error(f"Error in Anthropic sentiment analysis: {e}")
            return SentimentResult(
                label=SentimentLabel.NEUTRAL,
                score=0.5,
                confidence=0.0,
                provider="anthropic"
            )

    def _normalize_score(self, label: SentimentLabel, confidence: float) -> float:
        if label == SentimentLabel.POSITIVE:
            return 0.5 + (confidence / 2)
        elif label == SentimentLabel.NEGATIVE:
            return 0.5 - (confidence / 2)
        else:
            return 0.5
