package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
)

// LogEntry represents a single log entry from Winston
type LogEntry struct {
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Timestamp time.Time              `json:"timestamp"`
	Meta      map[string]interface{} `json:"meta,omitempty"`
}

// handleBatchLogs handles batched log entries from Winston Batch Transport
func handleBatchLogs(c *fiber.Ctx) error {
	// Check content type
	if c.Get("Content-Type") != "application/json" {
		return c.SendStatus(fiber.StatusUnsupportedMediaType)
	}

	// Read the request body
	var body []byte
	var err error

	// Check if the content is compressed
	if c.Get("Content-Encoding") == "gzip" {
		// Handle gzip compressed data
		gzReader, err := gzip.NewReader(bytes.NewReader(c.Body()))
		if err != nil {
			log.Printf("Error creating gzip reader: %v", err)
			return c.SendStatus(fiber.StatusBadRequest)
		}
		defer gzReader.Close()

		body, err = io.ReadAll(gzReader)
	} else {
		// Handle uncompressed data
		body = c.Body()
	}

	if err != nil {
		log.Printf("Error reading request body: %v", err)
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Parse the JSON payload
	var logEntries []LogEntry
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&logEntries); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Process log entries
	for _, entry := range logEntries {
		// Here you can implement your own logic to store or forward the logs
		// For example: writing to a database, forwarding to another service, etc.
		log.Printf("[%s] %s: %s", entry.Timestamp.Format(time.RFC3339), entry.Level, entry.Message)
	}

	// Send success response
	return c.JSON(fiber.Map{"status": "success"})
}

func main() {
	// Create new Fiber app
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	// Use compression middleware
	app.Use(compress.New())

	// Register the handler
	app.Post("/logs", handleBatchLogs)

	// Start the server
	port := ":3000"
	fmt.Printf("Server listening on port %s\n", port)
	log.Fatal(app.Listen(port))
}
